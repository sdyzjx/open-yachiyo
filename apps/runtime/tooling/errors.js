class ToolingError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ToolingError';
    this.code = code;
    this.details = details;
  }
}

const ErrorCode = {
  TOOL_NOT_FOUND: 'TOOL_NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  TIMEOUT: 'TIMEOUT',
  RUNTIME_ERROR: 'RUNTIME_ERROR',
  CONFIG_ERROR: 'CONFIG_ERROR'
};

module.exports = { ToolingError, ErrorCode };
