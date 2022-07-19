// Email to Email
const util = require('util');
const multer = require('multer');
const addrs = require("email-addresses");
const sgMail = require('@sendgrid/mail');

module.exports = async (req, res) => { 
    await util.promisify(multer().any())(req, res);

    const from = req.body.from;
    const subject = req.body.subject;
    const body = req.body.text;
    const html = req.body.html;

    // Strip for email 
    const fromAddress = addrs.parseOneAddress(from);

    // SendGrid API
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    
    // Create Email
    const email = {
        to: process.env.TO_EMAIL_ADDRESS,
        from: process.env.FROM_EMAIL_ADDRESS,
        subject: `${subject} [${fromAddress.domain}]`,
        text: `${body}`,
        html: `${html}`,
    };

    var patt = new RegExp("\.(buzz|guru|cyou|biz|live|co|us|today|icu|rest|bar|za.com|ru.com|sa.com|click)$");
    if (patt.test(fromAddress.domain)==false) {
        //Send Email
        sgResp = sgMail.send(email)
            .then(response => {
                res.status(200).send(`Sent Email`);
            })
            .catch(error => {
                res.status(500);
            });
        // res.status(200).send(`Sent Email`);
    } else {
        res.status(200).send(`Wont Sent Email`);
    }
};