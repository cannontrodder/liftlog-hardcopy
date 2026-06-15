import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { convertBackup, convertRows, preserveNewerSessions } from "./convert-backup.mjs";

const weightedExercise = {
  type: "WeightedExerciseBlueprint",
  name: "Bench Press ",
  sets: 2,
  repsPerSet: 8,
  restBetweenSets: { minRest: "PT1M30S" },
};

test("converts the active SQLite program and latest recorded session to browser JSON", () => {
  const programRows = [{
    id: "program-1",
    modelVersion: 1,
    payload: JSON.stringify({
      name: "Test Program",
      sessions: [{ name: "Push", exercises: [weightedExercise] }],
    }),
  }];
  const sessionRows = [
    {
      id: "older",
      modelVersion: 1,
      payload: JSON.stringify({
        date: "2026-06-10",
        blueprint: { name: "Push" },
        recordedExercises: [],
      }),
    },
    {
      id: "latest",
      modelVersion: 1,
      payload: JSON.stringify({
        date: "2026-06-14",
        blueprint: { name: "Push" },
        recordedExercises: [{
          blueprint: weightedExercise,
          potentialSets: [
            { set: { repsCompleted: 8 }, weight: { value: "60", unit: "kilograms" } },
            { set: { repsCompleted: 6 }, weight: { value: "62.5", unit: "kilograms" } },
          ],
        }],
      }),
    },
  ];

  assert.deepEqual(convertRows(programRows, sessionRows, "2026-06-15"), {
    name: "Test Program",
    backupDate: "2026-06-15",
    sessions: [{
      name: "Push",
      targetRestSeconds: 90,
      lastDate: "2026-06-14",
      exercises: [{
        name: "Bench Press",
        sets: 2,
        repsPerSet: 8,
        last: [
          { weight: "60", reps: 8 },
          { weight: "62.5", reps: 6 },
        ],
      }],
    }],
  });
});

test("rejects an unsupported SQLite payload model version", () => {
  assert.throws(
    () => convertRows([{ id: "program-1", modelVersion: 2, payload: "{}" }], [], "2026-06-15"),
    /Unsupported program modelVersion: 2/,
  );
});

test("accepts and validates a legacy JSON backup", () => {
  const directory = mkdtempSync(join(tmpdir(), "liftlog-backup-"));
  const backupPath = join(directory, "backup.json");
  const legacyBackup = {
    name: "Legacy Program",
    backupDate: "2026-06-12",
    sessions: [{
      name: "Push",
      targetRestSeconds: 90,
      lastDate: null,
      exercises: [{ name: "Bench Press", sets: 2, repsPerSet: 8, last: [] }],
    }],
  };
  writeFileSync(backupPath, JSON.stringify(legacyBackup));

  assert.deepEqual(convertBackup(backupPath, "2026-06-15"), {
    output: legacyBackup,
    source: "legacy JSON",
  });
});

test("rejects a backup that is neither SQLite nor valid JSON", () => {
  const directory = mkdtempSync(join(tmpdir(), "liftlog-backup-"));
  const backupPath = join(directory, "backup.bin");
  writeFileSync(backupPath, "not a backup");

  assert.throws(() => convertBackup(backupPath, "2026-06-15"), /neither SQLite nor valid JSON/);
});

test("preserves an existing session when it is newer than the converted backup", () => {
  const older = {
    name: "Program",
    backupDate: "2026-06-15",
    sessions: [{
      name: "Legs",
      targetRestSeconds: 90,
      lastDate: "2026-06-04",
      exercises: [{ name: "Squat", sets: 2, repsPerSet: 8, last: [] }],
    }],
  };
  const newer = {
    ...older,
    backupDate: "2026-06-12",
    sessions: [{
      ...older.sessions[0],
      lastDate: "2026-06-10",
      exercises: [{ name: "Squat", sets: 2, repsPerSet: 8, last: [{ weight: "100", reps: 8 }] }],
    }],
  };

  assert.deepEqual(preserveNewerSessions(older, newer).sessions, [{
    ...older.sessions[0],
    lastDate: "2026-06-10",
    exercises: [{ name: "Squat", sets: 2, repsPerSet: 8, last: [{ weight: "100", reps: 8 }] }],
  }]);
});
