const assert = require('node:assert/strict');
const test = require('node:test');

const handler = require('./email2email');
const {
    buildForwardEmail,
    parseInboundEmail,
} = handler._test;

test('parses raw RFC822 email and builds a forward payload', async () => {
    process.env.TO_EMAIL_ADDRESS = 'forward@example.com';

    const rawEmail = [
        'Delivered-To: ychian@gmail.com',
        'Received: by 2002:a05:612c:564e:b0:59a:5719:d59f with SMTP id p14csp3962770vqb;',
        ' Wed, 13 May 2026 23:14:29 -0700 (PDT)',
        'ARC-Seal: i=1; a=rsa-sha256; t=1778739269; cv=none; d=google.com;',
        ' s=arc-20240605; b=Tskr4NylIRbza5JfXvRWeiRBzTLebxSMP6Slq4HbEc+Ge2OAiAN/LAm5U296pItfdB',
        'Return-Path: <reservation@magia.tokyo>',
        'Date: Thu, 14 May 2026 15:14:28 +0900',
        'To: Josh S <ychian@gmail.com>',
        'From: A Happy Pancake <reservation@magia.tokyo>',
        'Subject: A Happy Pancake Changes of your account',
        'Message-ID: <21546c257bb628a702d84e8af25dcafd@magia.tokyo>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        '\u203bPLEASE DO NOT REPLY TO THIS EMAIL ADDRESS.',
        '',
        'Dear Josh S',
        '',
        'We acknowledge changes of your account as below.',
        '',
        'E-mail:  ychian@gmail.com',
        'Password:  XzVaiyP2',
        'Name:  Josh S',
        '',
        'Reservation Page',
        'http://magia.tokyo/reserve/',
        '',
    ].join('\r\n');

    const inboundEmail = await parseInboundEmail({
        body: { email: Buffer.from(rawEmail, 'utf8') },
        files: [],
    });
    const forwardEmail = buildForwardEmail(inboundEmail);

    assert.equal(inboundEmail.fromAddress.address, 'reservation@magia.tokyo');
    assert.equal(inboundEmail.toAddress.address, 'ychian@gmail.com');
    assert.equal(forwardEmail.to, 'forward@example.com');
    assert.equal(forwardEmail.from, 'ychian@gmail.com');
    assert.equal(forwardEmail.subject, 'A Happy Pancake Changes of your account [magia.tokyo]');
    assert.match(forwardEmail.text, /Password:\s+XzVaiyP2/);
    assert.equal('html' in forwardEmail, false);
});

test('keeps parsed SendGrid inbound fields working', async () => {
    process.env.TO_EMAIL_ADDRESS = 'forward@example.com';

    const inboundEmail = await parseInboundEmail({
        body: {
            from: 'Sender <sender@example.com>',
            to: 'Receiver <receiver@example.com>',
            subject: 'Parsed field message',
            text: 'Plain text body',
            html: '<p>Plain text body</p>',
            attachments: '0',
        },
        files: [],
    });
    const forwardEmail = buildForwardEmail(inboundEmail);

    assert.equal(forwardEmail.to, 'forward@example.com');
    assert.equal(forwardEmail.from, 'receiver@example.com');
    assert.equal(forwardEmail.subject, 'Parsed field message [example.com]');
    assert.equal(forwardEmail.text, 'Plain text body');
    assert.equal(forwardEmail.html, '<p>Plain text body</p>');
});
