import mitt from "mitt";
export const EventBus = mitt();

export enum EventTypes {
  FILE_UPDATED = "FILE_UPDATED",
  FOLDER_UPDATED = "FOLDER_UPDATED",
  AUTH_UPDATED = "AUTH_UPDATED",
  ALERT_MESSAGE = "ALERT_MESSAGE",
  AUTH_CODE = "AUTH_CODE",
  FOLDER_SELECTED = "FOLDER_SELECTED",
}

export function handleError(error: any): void {
  console.log(error);
  let text = error.response;
  if (error.response && error.response.data && error.response.data.error) {
    text = error.response.data.error;
  }
  EventBus.emit(EventTypes.ALERT_MESSAGE, {
    type: "error",
    text,
  });
}
