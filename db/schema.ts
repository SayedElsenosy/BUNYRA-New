/**
 * Typed Drizzle mirror for the BUNYRA inventory hierarchy.
 * SQL migrations in db/ are authoritative. Do not run drizzle-kit push on prod.
 * companyId == legacy tenantId; NEVER import a legacy NextAuth tenant ID.
 * Canonical unit pricing/status remains inventory_units; units is a 1:1 extension.
 */
import {sql} from 'drizzle-orm';
import {
  pgTable, uuid, text, timestamp, numeric, bigint, boolean, jsonb,
  foreignKey, unique, check, index, integer
} from 'drizzle-orm/pg-core';

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
});

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', {withTimezone:true}).notNull(),
}, table => [
  unique('projects_company_id_id_key').on(table.companyId,table.id),
  unique('projects_company_id_name_key').on(table.companyId,table.name),
]);

export const inventoryUnits = pgTable('inventory_units', {
  id: uuid('id').primaryKey(),
  companyId: uuid('company_id').notNull(),
  projectId: uuid('project_id').notNull(),
  code: text('code').notNull(),
  building: text('building').notNull(),
  floor: text('floor').notNull(),
  category: text('category').notNull(),
  area: numeric('area',{precision:12,scale:2}).notNull(),
  proposedPriceMinor: bigint('proposed_price_minor',{mode:'bigint'}).notNull(),
  status: text('status').notNull(),
  active: boolean('active').notNull(),
  version: integer('version').notNull(),
}, table => [
  unique('inventory_units_company_id_project_id_id_key').on(table.companyId,table.projectId,table.id),
  foreignKey({name:'inventory_units_company_id_project_id_fkey',
    columns:[table.companyId,table.projectId],
    foreignColumns:[projects.companyId,projects.id]}),
]);

export const phases = pgTable('phases', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull(),
  projectId: uuid('project_id').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
}, table => [
  unique('phases_company_id_project_id_id_key').on(table.companyId,table.projectId,table.id),
  unique('phases_company_id_project_id_name_key').on(table.companyId,table.projectId,table.name),
  foreignKey({name:'phases_project_scope_fk',
    columns:[table.companyId,table.projectId],
    foreignColumns:[projects.companyId,projects.id]}).onDelete('restrict'),
  index('phases_company_project_idx').on(table.companyId,table.projectId),
  check('phases_name_nonempty',sql`length(btrim(${table.name})) BETWEEN 1 AND 200`),
]);

export const buildings = pgTable('buildings', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull(),
  projectId: uuid('project_id').notNull(),
  phaseId: uuid('phase_id').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
}, table => [
  unique('buildings_company_id_project_id_id_key').on(table.companyId,table.projectId,table.id),
  unique('buildings_company_id_project_id_phase_id_name_key').on(table.companyId,table.projectId,table.phaseId,table.name),
  foreignKey({name:'buildings_phase_scope_fk',
    columns:[table.companyId,table.projectId,table.phaseId],
    foreignColumns:[phases.companyId,phases.projectId,phases.id]}).onDelete('restrict'),
  index('buildings_company_phase_idx').on(table.companyId,table.projectId,table.phaseId),
  check('buildings_name_nonempty',sql`length(btrim(${table.name})) BETWEEN 1 AND 200`),
]);

export const units = pgTable('units', {
  // Existing inventory_units.id, never a new independently generated unit identity.
  id: uuid('id').primaryKey(),
  companyId: uuid('company_id').notNull(),
  projectId: uuid('project_id').notNull(),
  buildingId: uuid('building_id').notNull(),
  svgCoordinates: jsonb('svg_coordinates').$type<Record<string,unknown>|null>(),
  createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
}, table => [
  unique('units_company_id_project_id_id_key').on(table.companyId,table.projectId,table.id),
  foreignKey({name:'units_inventory_scope_fk',
    columns:[table.companyId,table.projectId,table.id],
    foreignColumns:[inventoryUnits.companyId,inventoryUnits.projectId,inventoryUnits.id]}).onDelete('restrict'),
  foreignKey({name:'units_building_scope_fk',
    columns:[table.companyId,table.projectId,table.buildingId],
    foreignColumns:[buildings.companyId,buildings.projectId,buildings.id]}).onDelete('restrict'),
  index('units_company_building_idx').on(table.companyId,table.projectId,table.buildingId),
  check('units_coordinates_object',sql`${table.svgCoordinates} IS NULL OR jsonb_typeof(${table.svgCoordinates})='object'`),
]);
