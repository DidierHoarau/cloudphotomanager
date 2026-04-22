import mitt from "mitt";
export const EventBus = mitt();

export enum EventTypes {
  FILE_UPDATED = "FILE_UPDATED",
  FOLDER_UPDATED = "FOLDER_UPDATED",
  FOLDER_CACHE_UPDATED = "FOLDER_CACHE_UPDATED",
  AUTH_UPDATED = "AUTH_UPDATED",
  ALERT_MESSAGE = "ALERT_MESSAGE",
  AUTH_CODE = "AUTH_CODE",
  FOLDER_SELECTED = "FOLDER_SELECTED",
  OPERATION_COMPLETE = "OPERATION_COMPLETE",
}

export function handleError(error: any): void {
  console.log(error);
  let text = "An unexpected error occurred";
  if (error.response) {
    if (error.response.data && error.response.data.error) {
      text = error.response.data.error;
    } else if (error.response.data && typeof error.response.data === "string") {
      text = error.response.data;
    } else if (error.response.statusText) {
      text = `${error.response.status} - ${error.response.statusText}`;
    } else {
      text = `HTTP error ${error.response.status}`;
    }
  } else if (error.request) {
    text = "No response from server";
  } else if (error.message) {
    text = error.message;
  }
  EventBus.emit(EventTypes.ALERT_MESSAGE, {
    type: "error",
    text,
  });
}
