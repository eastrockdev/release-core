export function promptSafetyConfirmation({
  phrase,
  message,
}) {
  const value = window.prompt(
    `${message}\n\nType ${phrase} to continue.`,
  );

  if (value === null) return null;

  if (String(value).trim() !== phrase) {
    window.alert(
      `Confirmation did not match ${phrase}. No changes were made.`,
    );
    return null;
  }

  return phrase;
}
