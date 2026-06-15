#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function parsePayload(row, table) {
  if (row.modelVersion !== 1) {
    throw new Error(`Unsupported ${table} modelVersion: ${row.modelVersion}`);
  }

  try {
    return JSON.parse(row.payload);
  } catch (error) {
    throw new Error(`Invalid JSON payload in ${table} row ${row.id}: ${error.message}`);
  }
}

function durationSeconds(duration) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(duration || "");
  if (!match) return 90;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

function completedSets(recordedExercise) {
  return (recordedExercise?.potentialSets || [])
    .filter(({ set }) => Number.isFinite(set?.repsCompleted))
    .map(({ set, weight }) => ({
      weight: String(weight?.value ?? "0"),
      reps: set.repsCompleted,
    }));
}

export function convertRows(programRows, sessionRows, backupDate) {
  if (programRows.length !== 1) {
    throw new Error(`Expected exactly one active program, found ${programRows.length}`);
  }

  const program = parsePayload(programRows[0], "program");
  const recordedSessions = sessionRows
    .map((row) => parsePayload(row, "session"))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const sessions = program.sessions.map((sessionBlueprint) => {
    const latest = recordedSessions.find(
      (session) => session.blueprint?.name === sessionBlueprint.name,
    );
    const recordedByName = new Map(
      (latest?.recordedExercises || []).map((exercise) => [exercise.blueprint?.name, exercise]),
    );

    return {
      name: sessionBlueprint.name,
      targetRestSeconds: durationSeconds(
        sessionBlueprint.exercises[0]?.restBetweenSets?.minRest,
      ),
      lastDate: latest?.date || null,
      exercises: sessionBlueprint.exercises.map((exercise) => ({
        name: exercise.name.trim(),
        sets: exercise.sets,
        repsPerSet: exercise.repsPerSet,
        last: completedSets(recordedByName.get(exercise.name)),
      })),
    };
  });

  const output = {
    name: program.name,
    backupDate,
    sessions,
  };
  validateOutput(output);
  return output;
}

export function validateOutput(output) {
  if (!output.name || !output.backupDate || !Array.isArray(output.sessions) || !output.sessions.length) {
    throw new Error("Converted backup is missing name, backupDate, or sessions");
  }

  for (const session of output.sessions) {
    if (!session.name || !Array.isArray(session.exercises) || !session.exercises.length) {
      throw new Error("Converted backup contains an invalid session");
    }
    for (const exercise of session.exercises) {
      if (!exercise.name || !Number.isInteger(exercise.sets) || !Number.isInteger(exercise.repsPerSet)) {
        throw new Error(`Converted backup contains an invalid exercise in ${session.name}`);
      }
    }
  }
}

export function preserveNewerSessions(output, existing) {
  if (!existing) return output;
  validateOutput(existing);

  const existingByName = new Map(existing.sessions.map((session) => [session.name, session]));
  return {
    ...output,
    sessions: output.sessions.map((session) => {
      const previous = existingByName.get(session.name);
      if (!previous?.lastDate || (session.lastDate && previous.lastDate <= session.lastDate)) {
        return session;
      }

      const previousExercises = new Map(
        previous.exercises.map((exercise) => [exercise.name, exercise]),
      );
      return {
        ...session,
        lastDate: previous.lastDate,
        exercises: session.exercises.map((exercise) => ({
          ...exercise,
          last: previousExercises.get(exercise.name)?.last || exercise.last,
        })),
      };
    }),
  };
}

export function convertBackup(databaseOrJsonPath, backupDate) {
  const input = readFileSync(databaseOrJsonPath);
  if (input.subarray(0, 16).toString() === "SQLite format 3\u0000") {
    const programRows = query(
      databaseOrJsonPath,
      "SELECT id, modelVersion, payload FROM program WHERE active = 1",
    );
    const sessionRows = query(databaseOrJsonPath, "SELECT id, modelVersion, payload FROM session");
    return {
      output: convertRows(programRows, sessionRows, backupDate),
      source: `SQLite (${sessionRows.length} recorded sessions)`,
    };
  }

  let output;
  try {
    output = JSON.parse(input.toString("utf8"));
  } catch (error) {
    throw new Error(`Backup is neither SQLite nor valid JSON: ${error.message}`);
  }
  validateOutput(output);
  return { output, source: "legacy JSON" };
}

function query(databasePath, sql) {
  const result = execFileSync("sqlite3", ["-json", databasePath, sql], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(result || "[]");
}

function main([backupPath, outputPath, backupDate, existingOutputPath]) {
  if (!backupPath || !outputPath || !backupDate) {
    throw new Error(
      "Usage: node scripts/convert-backup.mjs <backup> <output.json> <YYYY-MM-DD> [existing-output.json]",
    );
  }

  const converted = convertBackup(backupPath, backupDate);
  const existing = existingOutputPath
    ? convertBackup(existingOutputPath, backupDate).output
    : null;
  const output = preserveNewerSessions(converted.output, existing);
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Converted ${converted.source} into ${output.sessions.length} workouts`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
