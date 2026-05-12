// Email to Email
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { TextDecoder } = require('util');
const busboy = require('busboy');
const addrs = require("email-addresses");
const sgMail = require('@sendgrid/mail');

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

    return JSON.parse(decodeFormValue(value, 'utf-8'));
}

module.exports = async (req, res) => { 
    const parsedForm = await parseInboundForm(req);
    const reqBody = parsedForm.body;
    const charsets = parseJsonFormValue(reqBody.charsets);

    const from = decodeFormValue(reqBody.from, charsets.from);
    const to = decodeFormValue(reqBody.to, charsets.to);
    const subject = decodeFormValue(reqBody.subject, charsets.subject);
    const body = decodeFormValue(reqBody.text, charsets.text);
    const html = decodeFormValue(reqBody.html, charsets.html);
    const attachmentCount = Number.parseInt(decodeFormValue(reqBody.attachments, 'utf-8'), 10) || 0;

    // Strip for email 
    const fromAddress = addrs.parseOneAddress(from);
    const toAddress = addrs.parseOneAddress(to);

    // SendGrid API
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    var email = {};
    if (attachmentCount > 0){

        // Create Email with attachment
        const attachmentInfo = parseJsonFormValue(reqBody['attachment-info']);

        let attachmentsArray = [];
        var files = parsedForm.files;
        if(files){
            files.forEach(function(file){
                const attachmentMeta = attachmentInfo[file.fieldname] || {};
                var attachment = fs.readFileSync(file.path).toString("base64");
                const attachmentContent = {
                    content: attachment,
                    filename: attachmentMeta.filename || attachmentMeta.name || file.originalname,
                    type: attachmentMeta.type || file.mimetype,
                    disposition: "attachment"
                }
                attachmentsArray.push(attachmentContent);
            });
        }   

        //Create Email With Attachment
        email = {
            to: process.env.TO_EMAIL_ADDRESS,
            from: toAddress.address,
            subject: `${subject} attach [${fromAddress.domain}]`,
            text: `${body}`,
            html: `${html}`,
            attachments: attachmentsArray,
        };
        
    } else {
        // Create Email
        email = {
            to: process.env.TO_EMAIL_ADDRESS,
            from: toAddress.address,
            subject: `${subject} [${fromAddress.domain}]`,
            text: `${body}`,
            html: `${html}`,
        };
    } 

    var patt = new RegExp("\.(buzz|guru|cyou|biz|live|co|us|today|icu|rest|bar|za.com|ru.com|sa.com|click)$");
    if (patt.test(fromAddress.domain)==false) {
        //Send Email
        sgMail.send(email)
            .then(response => {
                res.status(200).send(`Sent Email`);
            })
            .catch(error => {
                res.status(500);
            });    
    } else {
        res.status(200).send(`Wont Sent Email`);
    }
};