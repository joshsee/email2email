// Email to Email
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { TextDecoder } = require('util');
const busboy = require('busboy');
const addrs = require("email-addresses");
const sgMail = require('@sendgrid/mail');
const { simpleParser } = require('mailparser');

const blockedDomainPattern = /\.(buzz|guru|cyou|biz|live|co|us|today|icu|rest|bar|za\.com|ru\.com|sa\.com|click)$/i;

class InboundEmailError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.name = 'InboundEmailError';
        this.statusCode = statusCode;
    }
}

function parseInboundForm(req) {
    return new Promise((resolve, reject) => {
        const body = {};
        const files = [];
        const fileWrites = [];
        let parser;

        try {
            parser = busboy({
                headers: req.headers,
                // SendGrid provides original field charsets separately. Decode as
                // latin1 first so each byte can be recovered and decoded below.
                defCharset: 'latin1',
            });
        } catch (error) {
            reject(error);
            return;
        }

        parser.on('field', (name, value) => {
            body[name] = value;
        });

        parser.on('file', (fieldname, file, info) => {
            if (!info.filename) {
                file.resume();
                return;
            }

            const filename = `email2email-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
            const filePath = path.join(os.tmpdir(), filename);
            const writeStream = fs.createWriteStream(filePath);

            fileWrites.push(new Promise((resolveFile, rejectFile) => {
                file.on('error', rejectFile);
                writeStream.on('error', rejectFile);
                writeStream.on('finish', () => {
                    files.push({
                        fieldname: fieldname,
                        path: filePath,
                        originalname: info.filename,
                        mimetype: info.mimeType,
                    });
                    resolveFile();
                });
            }));

            file.pipe(writeStream);
        });

        parser.on('error', reject);
        parser.on('close', () => {
            Promise.all(fileWrites)
                .then(() => resolve({ body: body, files: files }))
                .catch(reject);
        });

        req.pipe(parser);
    });
}

function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];

        req.on('data', (chunk) => chunks.push(chunk));
        req.on('error', reject);
        req.on('end', () => resolve(Buffer.concat(chunks)));
    });
}

function isMultipartRequest(req) {
    const contentType = req.headers && (req.headers['content-type'] || req.headers['Content-Type']);
    return Boolean(contentType && /multipart\/form-data/i.test(contentType));
}

async function parseInboundRequest(req) {
    if (isMultipartRequest(req)) {
        return parseInboundForm(req);
    }

    return {
        body: {
            email: await readRequestBody(req),
        },
        files: [],
    };
}

function decodeFormValue(value, charset) {
    if (value === undefined || value === null) {
        return '';
    }

    const rawValue = Array.isArray(value) ? value[value.length - 1] : value;
    const bytes = Buffer.from(String(rawValue), 'latin1');
    const encoding = charset || 'utf-8';

    try {
        return new TextDecoder(encoding).decode(bytes);
    } catch (error) {
        return bytes.toString('utf8');
    }
}

function parseJsonFormValue(value) {
    if (!value) {
        return {};
    }

    try {
        return JSON.parse(decodeFormValue(value, 'utf-8'));
    } catch (error) {
        return {};
    }
}

function formValueAsBuffer(value) {
    if (Buffer.isBuffer(value)) {
        return value;
    }

    const rawValue = Array.isArray(value) ? value[value.length - 1] : value;
    return Buffer.from(String(rawValue || ''), 'latin1');
}

function parseOneAddress(value) {
    if (!value) {
        return null;
    }

    return addrs.parseOneAddress(value);
}

function parseMailparserAddress(addressObject) {
    const addressValues = Array.isArray(addressObject)
        ? addressObject.flatMap((entry) => entry.value || [])
        : (addressObject && addressObject.value) || [];
    const mailbox = addressValues.find((entry) => entry.address);

    if (!mailbox) {
        return null;
    }

    return parseOneAddress(mailbox.address);
}

function validateInboundEmail(inboundEmail) {
    if (!inboundEmail.fromAddress || !inboundEmail.fromAddress.address) {
        throw new InboundEmailError('Missing or invalid From address');
    }

    if (!inboundEmail.toAddress || !inboundEmail.toAddress.address) {
        throw new InboundEmailError('Missing or invalid To address');
    }
}

function buildFormAttachments(parsedForm, reqBody) {
    const attachmentCount = Number.parseInt(decodeFormValue(reqBody.attachments, 'utf-8'), 10) || 0;

    if (attachmentCount <= 0) {
        return [];
    }

    const attachmentInfo = parseJsonFormValue(reqBody['attachment-info']);
    const files = parsedForm.files || [];

    return files.map((file) => {
        const attachmentMeta = attachmentInfo[file.fieldname] || {};
        const attachment = fs.readFileSync(file.path).toString('base64');

        fs.unlink(file.path, () => {});

        return {
            content: attachment,
            filename: attachmentMeta.filename || attachmentMeta.name || file.originalname,
            type: attachmentMeta.type || file.mimetype,
            disposition: 'attachment',
        };
    });
}

function buildRawAttachments(attachments) {
    return (attachments || []).map((attachment) => {
        const sendGridAttachment = {
            content: attachment.content.toString('base64'),
            filename: attachment.filename || 'attachment',
            type: attachment.contentType || 'application/octet-stream',
            disposition: attachment.contentDisposition || 'attachment',
        };

        if (attachment.contentId) {
            sendGridAttachment.content_id = attachment.contentId.replace(/^<|>$/g, '');
        }

        return sendGridAttachment;
    });
}

async function parseRawInboundEmail(rawEmail) {
    const parsed = await simpleParser(formValueAsBuffer(rawEmail));

    return {
        from: parsed.from ? parsed.from.text : '',
        to: parsed.to ? parsed.to.text : '',
        subject: parsed.subject || '',
        text: parsed.text || '',
        html: typeof parsed.html === 'string' ? parsed.html : '',
        fromAddress: parseMailparserAddress(parsed.from),
        toAddress: parseMailparserAddress(parsed.to),
        attachments: buildRawAttachments(parsed.attachments),
    };
}

async function parseInboundEmail(parsedForm) {
    const reqBody = parsedForm.body;

    if (reqBody.email) {
        return parseRawInboundEmail(reqBody.email);
    }

    const charsets = parseJsonFormValue(reqBody.charsets);

    const from = decodeFormValue(reqBody.from, charsets.from);
    const to = decodeFormValue(reqBody.to, charsets.to);
    const subject = decodeFormValue(reqBody.subject, charsets.subject);
    const body = decodeFormValue(reqBody.text, charsets.text);
    const html = decodeFormValue(reqBody.html, charsets.html);

    return {
        from: from,
        to: to,
        subject: subject,
        text: body,
        html: html,
        fromAddress: parseOneAddress(from),
        toAddress: parseOneAddress(to),
        attachments: buildFormAttachments(parsedForm, reqBody),
    };
}

function buildForwardEmail(inboundEmail) {
    validateInboundEmail(inboundEmail);

    const email = {
        to: process.env.TO_EMAIL_ADDRESS,
        from: inboundEmail.toAddress.address,
        subject: `${inboundEmail.subject}${inboundEmail.attachments.length > 0 ? ' attach' : ''} [${inboundEmail.fromAddress.domain}]`,
        text: inboundEmail.text || '',
    };

    if (inboundEmail.html) {
        email.html = inboundEmail.html;
    }

    if (inboundEmail.attachments.length > 0) {
        email.attachments = inboundEmail.attachments;
    }

    return email;
}

async function handler(req, res) {
    try {
        const parsedForm = await parseInboundRequest(req);
        const inboundEmail = await parseInboundEmail(parsedForm);

        validateInboundEmail(inboundEmail);

        if (blockedDomainPattern.test(inboundEmail.fromAddress.domain)) {
            return res.status(200).send(`Wont Sent Email`);
        }

        // SendGrid API
        sgMail.setApiKey(process.env.SENDGRID_API_KEY);
        await sgMail.send(buildForwardEmail(inboundEmail));

        return res.status(200).send(`Sent Email`);
    } catch (error) {
        const statusCode = error.statusCode || 500;
        console.error('email2email failed:', error);
        return res.status(statusCode).send(statusCode === 500 ? 'Failed to process inbound email' : error.message);
    }
}

module.exports = handler;
module.exports._test = {
    buildForwardEmail,
    decodeFormValue,
    parseInboundEmail,
    parseRawInboundEmail,
};