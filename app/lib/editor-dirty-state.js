import {
  useCallback,
  useEffect,
  useState,
} from "react";
import { useBlocker } from "react-router";

const DEFAULT_UNSAVED_MESSAGE =
  "You have unsaved changes. Leave this editor and discard them?";

export function editorSaveStateLabel(state) {
  return (
    {
      saved: "Saved",
      dirty: "Unsaved changes",
      saving: "Saving…",
      error: "Save failed · changes kept",
    }[state] || "Saved"
  );
}

export function useEditorDirtyState({
  enabled = true,
  message = DEFAULT_UNSAVED_MESSAGE,
} = {}) {
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] =
    useState("saved");

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      Boolean(
        enabled &&
          dirty &&
          currentLocation.pathname !==
            nextLocation.pathname,
      ),
  );

  useEffect(() => {
    if (blocker.state !== "blocked") return;

    if (window.confirm(message)) {
      setDirty(false);
      setSaveState("saved");
      blocker.proceed();
      return;
    }

    blocker.reset();
  }, [blocker, message]);

  useEffect(() => {
    if (!enabled || !dirty) return undefined;

    const beforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener(
      "beforeunload",
      beforeUnload,
    );

    return () => {
      window.removeEventListener(
        "beforeunload",
        beforeUnload,
      );
    };
  }, [dirty, enabled]);

  const markDirty = useCallback(() => {
    setDirty(true);
    setSaveState("dirty");
  }, []);

  const markSaving = useCallback(() => {
    setSaveState("saving");
  }, []);

  const markSaved = useCallback(() => {
    setDirty(false);
    setSaveState("saved");
  }, []);

  const markError = useCallback(() => {
    setDirty(true);
    setSaveState("error");
  }, []);

  const discardChanges = useCallback(() => {
    setDirty(false);
    setSaveState("saved");
  }, []);

  return {
    dirty,
    saveState,
    markDirty,
    markSaving,
    markSaved,
    markError,
    discardChanges,
  };
}
