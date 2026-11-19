// Minimal focus trap/restore helpers shared by the app dialogs. They keep
// keyboard users inside an open dialog (WCAG 2.1.2 / 2.4.3) and give focus
// back to the element that opened it when the dialog closes.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function dialogFocusableElements(
  container: HTMLElement | null | undefined,
): HTMLElement[] {
  if (!container) {
    return [];
  }
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      element.offsetWidth > 0 ||
      element.offsetHeight > 0 ||
      element === document.activeElement,
  );
}

export function dialogFocusFirst(
  container: HTMLElement | null | undefined,
): void {
  if (!container) {
    return;
  }
  const elements = dialogFocusableElements(container);
  if (elements.length > 0) {
    elements[0].focus();
    return;
  }
  container.focus();
}

export function dialogTrapFocus(
  event: KeyboardEvent,
  container: HTMLElement | null | undefined,
): void {
  if (!container || event.key !== "Tab") {
    return;
  }
  const elements = dialogFocusableElements(container);
  if (elements.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }
  const first = elements[0];
  const last = elements[elements.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
