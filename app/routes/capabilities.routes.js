const express = require("express");

const { getPublicCapabilities } = require("../config/capabilities.config");

const router = express.Router();

router.get("/", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    data: getPublicCapabilities(),
    requestId: req.requestId || "",
  });
});

module.exports = router;
