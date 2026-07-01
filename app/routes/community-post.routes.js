const express = require("express");

const communityPostController = require("../controllers/community-post.controller");
const authJwt = require("../middleware/auth-jwt");

const router = express.Router();

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

router.get("/", asyncHandler(authJwt.attachSession), asyncHandler(communityPostController.list));
router.post("/", asyncHandler(authJwt.requireAuth), asyncHandler(communityPostController.create));
router.patch("/:id", asyncHandler(authJwt.requireAuth), asyncHandler(communityPostController.update));
router.delete("/:id", asyncHandler(authJwt.requireAuth), asyncHandler(communityPostController.remove));

module.exports = router;
