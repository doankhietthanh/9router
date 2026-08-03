import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function normalizeModel(model) {
  const normalized = typeof model === "string" ? model.trim() : "";
  if (!normalized) throw new Error("Model is required");
  return normalized;
}

function normalizeConnectionIds(connectionIds) {
  if (!Array.isArray(connectionIds)) return [];
  return [...new Set(connectionIds.map((id) => String(id).trim()).filter(Boolean))];
}

function rowToModelRoute(row) {
  if (!row) return null;
  return {
    model: row.model,
    connectionIds: parseJson(row.connectionIds, []),
    isActive: row.isActive !== 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getModelRoutes() {
  const db = await getAdapter();
  return db.all(`SELECT * FROM modelRoutes ORDER BY model ASC`).map(rowToModelRoute);
}

export async function getModelRouteByModel(model) {
  const db = await getAdapter();
  const normalized = normalizeModel(model);
  return rowToModelRoute(db.get(`SELECT * FROM modelRoutes WHERE model = ?`, [normalized]));
}

export async function upsertModelRoute(model, connectionIds, isActive = true) {
  const db = await getAdapter();
  const normalizedModel = normalizeModel(model);
  const normalizedIds = normalizeConnectionIds(connectionIds);
  const active = isActive !== false;
  if (active && normalizedIds.length === 0) {
    throw new Error("At least one connectionId is required for an active route");
  }

  const existing = db.get(`SELECT createdAt FROM modelRoutes WHERE model = ?`, [normalizedModel]);
  const now = new Date().toISOString();
  const createdAt = existing?.createdAt || now;
  const route = {
    model: normalizedModel,
    connectionIds: normalizedIds,
    isActive: active,
    createdAt,
    updatedAt: now,
  };

  db.run(
    `INSERT INTO modelRoutes(model, connectionIds, isActive, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(model) DO UPDATE SET
       connectionIds = excluded.connectionIds,
       isActive = excluded.isActive,
       updatedAt = excluded.updatedAt`,
    [route.model, stringifyJson(route.connectionIds), route.isActive ? 1 : 0, route.createdAt, route.updatedAt]
  );
  return route;
}

export async function deleteModelRoute(model) {
  const db = await getAdapter();
  const normalized = normalizeModel(model);
  const result = db.run(`DELETE FROM modelRoutes WHERE model = ?`, [normalized]);
  return (result?.changes ?? 0) > 0;
}
