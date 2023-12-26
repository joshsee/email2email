// Email to Email
const util = require('util');
const fs = require('fs');
const multer = require('multer');
const addrs = require("email-addresses");
const sgMail = require('@sendgrid/mail');

module.exports = async (req, res) => { 
    await util.promisify(multer({ dest: '/tmp' }).any())(req, res);

    const from = req.body.from;
    const to = req.body.to;
    const subject = req.body.subject;
    const body = req.body.text;
    const html = req.body.html;

    // Strip for email 
    const fromAddress = addrs.parseOneAddress(from);
    const toAddress = addrs.parseOneAddress(to);

    // SendGrid API
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    
    // Create Email
    const email = {
        to: process.env.TO_EMAIL_ADDRESS,
        from: toAddress.address,
        subject: `${subject} [${fromAddress.domain}]`,
        text: `${body}`,
        html: `${html}`,
    };

    if (req.body.attachments>0){

        // Create Email with attachment
        const attachmentInfo = JSON.parse(req.body['attachment-info']);

        let attachmentsArray = [];
        // for (let i = 1; i <= req.body.attachments; i++) {
        //     const attachmentNo = `${'attachment' + i}`;
        //     pathToAttachment = `${'/tmp/' + attachmentInfo[attachmentNo].filename}`;
        //     attachment = fs.readFileSync(pathToAttachment).toString("base64");
        //     const attachmentContent = {
        //         content: attachment,
        //         filename: attachmentInfo[attachmentNo].filename,
        //         type: attachmentInfo[attachmentNo].type,
        //         disposition: "attachment"
        //     }
        //     attachmentsArray.push(attachmentContent);
        // }

        var files = req.files;
        if(files){
            let i = 1;
            files.forEach(function(file){
                const attachmentNo = `${'attachment' + i}`;
                var attachment = fs.readFileSync(file.path).toString("base64");
                const attachmentContent = {
                    content: attachment,
                    filename: file.originalname,
                    type: attachmentInfo[attachmentNo].type,
                    disposition: "attachment"
                }
                attachmentsArray.push(attachmentContent);
            });
        }   

        //Create Email With Attachment
        const emailAttach = {
            to: process.env.TO_EMAIL_ADDRESS,
            from: toAddress.address,
            subject: `${subject} attach [${fromAddress.domain}]`,
            text: `${body}`,
            html: `${html}`,
            attachments: attachmentsArray,
        };
        
    } 

    var patt = new RegExp("\.(buzz|guru|cyou|biz|live|co|us|today|icu|rest|bar|za.com|ru.com|sa.com|click)$");
    if (patt.test(fromAddress.domain)==false) {

        if (req.body.attachments>0){
            //Send Email With Attachment
            sgResp = sgMail.send(emailAttach)
                .then(response => {
                    res.status(200).send(`Sent Email`);
                })
                .catch(error => {
                    res.status(500);
                });
        } else {
            //Send Email
            sgResp = sgMail.send(email)
                .then(response => {
                    res.status(200).send(`Sent Email`);
                })
                .catch(error => {
                    res.status(500);
                });
        }    
    } else {
        res.status(200).send(`Wont Sent Email`);
    }
};