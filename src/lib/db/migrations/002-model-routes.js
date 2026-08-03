import { TABLES, buildCreateTableSql } from "../schema.js";

export default {
  version: 2,
  name: "model-routes",
  up(db) {
    const definition = TABLES.modelRoutes;
    db.exec(buildCreateTableSql("modelRoutes", definition));
    for (const idx of definition.indexes || []) db.exec(idx);
  },
};
