interface ApiResponse<T = any> {
  Status: number;
  message: string;
  data?: T;
  error?: any;
}


// 200 OK
export function successResponse<T>(
  data: T,
  message = 'Success',
  Status = 200,
): ApiResponse<T> {
  return { Status, message, data };
}

// 201 Created
export function createdResponse<T>(
  data: T,
  message = 'Resource created successfully',
): ApiResponse<T> {
  return { Status: 201, message, data };
}

// 400 Bad Request
export function badRequestResponse(
  message = 'Bad request',
  error?: any,
): ApiResponse {
  return { Status: 400, message, error };
}

// 401 Unauthorized
export function unauthorizedResponse(
  message = 'Unauthorized',
  error?: any,
): ApiResponse {
  return { Status: 401, message, error };
}

// 403 Forbidden
export function forbiddenResponse(
  message = 'Forbidden',
  error?: any,
): ApiResponse {
  return { Status: 403, message, error };
}

// 404 Not Found
export function notFoundResponse(
  message = 'Resource not found',
  error?: any,
): ApiResponse {
  return { Status: 404, message, error };
}

// 409 Conflict
export function conflictResponse(
  message = 'Conflict occurred',
  error?: any,
): ApiResponse {
  return { Status: 409, message, error };
}

// 422 Validation Error
export function validationErrorResponse(
  errors: Record<string, string[]>,
  message = 'Validation failed',
): ApiResponse {
  return { Status: 422, message, error: errors };
}

// 500 Internal Server Error
export function errorResponse(
  message = 'Something went wrong',
  error?: any,
  Status = 500,
): ApiResponse {
  return { Status, message, error };
}
