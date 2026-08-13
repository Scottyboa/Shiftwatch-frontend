// Client ID er en offentlig app-identifikator, ikke en hemmelig nøkkel.
// Samme Client ID må brukes her og i ShiftWatch-agenten for at begge skal
// få tilgang til den samme OneDrive App Folder-mappen.
export const ONEDRIVE_CONFIG = Object.freeze({
  clientId: "1dd6b6fa-65d6-476c-aa39-dc1f42829ff1",
  tenant: "consumers",
  scope: "Files.ReadWrite.AppFolder",
  fileName: "shiftwatch_calendar_config.json",
  sourceAgent: "ShiftWatch Frontend",
});
