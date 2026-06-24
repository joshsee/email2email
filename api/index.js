module.exports = (req, res) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.status(200).send('Nothing to see here');
};
