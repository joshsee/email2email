// Email to Email
const util = require('util');
const multer = require('multer');
const addrs = require("email-addresses");
const sgMail = require('@sendgrid/mail');
const twilio = require('twilio');

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
        to: process.env.DESTINATION_EMAIL,
        from: `${fromAddress}`,
        subject: `${subject}`,
        text: `${body}`,
        html: `${html}`,
    };

    //Send Email
    sgResp = sgMail.send(email)
        .then(response => {
            res.status(200).send("Sent Error Email");
        })
        .catch(error => {
            res.status(500);
        });
};