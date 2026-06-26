// backend/src/shared/middlewares/error.middleware.js

/**
 * Global error handler middleware
 */
const errorMiddleware = (err, req, res, next) => {
  console.error('🔴 Error caught:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    url: req.originalUrl,
    method: req.method,
  });

  // Default error
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let errors = err.errors || null;

  // Prisma errors
  if (err.code === 'P2002') {
    statusCode = 409;
    message = 'A record with this value already exists';
  }

  if (err.code === 'P2025') {
    statusCode = 404;
    message = 'Record not found';
  }

  if (err.code === 'P2003') {
    statusCode = 400;
    message = 'Foreign key constraint failed';
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
  }

  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation failed';
  }

  // Clerk errors
  if (err.message?.includes('Clerk')) {
    statusCode = 401;
  }

  // Response
  res.status(statusCode).json({
    success: false,
    message,
    ...(errors && { errors }),
    ...(err.existingAccount && { existingAccount: true }),
    ...(process.env.NODE_ENV === 'development' && { 
      stack: err.stack,
      originalError: err.message,
    }),
  });
};

export default errorMiddleware;