const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");
const { ApiError } = require("../utils");
const { env } = require("../config");
const { findUserByRefreshToken } = require("../modules/auth/auth-repository");

const authenticateToken = asyncHandler(async (req, res, next) => {
  const { accessToken, refreshToken } = req.cookies || {};

  if (!accessToken || !refreshToken) {
    throw new ApiError(401, "Unauthorized. Please provide valid tokens.");
  }

  let user;
  let refreshTokenPayload;
  try {
    user = jwt.verify(accessToken, env.JWT_ACCESS_TOKEN_SECRET);
    refreshTokenPayload = jwt.verify(refreshToken, env.JWT_REFRESH_TOKEN_SECRET);
  } catch (error) {
    throw new ApiError(401, "Unauthorized. Please provide valid tokens.");
  }

  if (Number(user.id) !== Number(refreshTokenPayload.id)) {
    throw new ApiError(401, "Unauthorized. Token owners do not match.");
  }

  const sessionUser = await findUserByRefreshToken(refreshToken);
  if (
    !sessionUser ||
    !sessionUser.is_active ||
    Number(sessionUser.id) !== Number(user.id) ||
    Number(sessionUser.role_id) !== Number(user.roleId)
  ) {
    throw new ApiError(401, "Unauthorized. Session is no longer active.");
  }

  req.user = user;
  req.refreshToken = refreshTokenPayload;
  next();
});

module.exports = { authenticateToken };
