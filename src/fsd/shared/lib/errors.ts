import { ApiError } from "../api";

export function isUnauthorizedError(error: unknown) {
  return error instanceof ApiError && error.status === 401;
}

export function getErrorText(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Произошла неизвестная ошибка";
}
