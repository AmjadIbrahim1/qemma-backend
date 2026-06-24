import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret-key";
// ✅ 365 يوم بدل 7 أيام — الجلسة تفضل مفتوحة لسنة كاملة
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "365d";

if (JWT_SECRET === "fallback-secret-key") {
  console.warn("⚠️  Using fallback JWT_SECRET. Set JWT_SECRET in production!");
}

export const generateToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
};

export const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    throw new Error("Invalid or expired token");
  }
};

export const decodeToken = (token) => {
  return jwt.decode(token);
};

export { JWT_SECRET };
