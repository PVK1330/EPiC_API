import { DataTypes } from "sequelize";

/**
 * Sponsor Licence Intake Form
 *
 * Stores the 12-field information form that a sponsor must complete before
 * Government Registration can begin. One row per licence application (1-to-1).
 *
 * Conditions JSONB tracks which conditional document categories apply, driving
 * the document checklist engine in LicenceIntakeDocument.
 */
export default function defineLicenceIntakeForm(sequelize) {
  return sequelize.define(
    "LicenceIntakeForm",
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

      licenceApplicationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "licence_application_id",
        references: { model: "licence_applications", key: "id" },
        onDelete: "CASCADE",
      },

      organisationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "organisation_id",
      },

      // ── 12 information form fields ─────────────────────────────────────────
      tradingName: {
        type: DataTypes.STRING(255),
        field: "trading_name",
      },

      premisesAddress: {
        type: DataTypes.JSONB,
        field: "premises_address",
        comment: "{ line1, line2, city, county, postcode, country }",
      },

      owningLimitedCompany: {
        type: DataTypes.STRING(255),
        field: "owning_limited_company",
      },

      namedPersonOnLicence: {
        type: DataTypes.STRING(255),
        field: "named_person_on_licence",
      },

      phoneNumber: {
        type: DataTypes.STRING(30),
        field: "phone_number",
      },

      niNumber: {
        type: DataTypes.STRING(20),
        field: "ni_number",
      },

      emailAddress: {
        type: DataTypes.STRING(255),
        field: "email_address",
      },

      jobTitlesRequired: {
        type: DataTypes.JSONB,
        field: "job_titles_required",
        defaultValue: [],
        comment: "Array of job title strings",
      },

      companyWebsite: {
        type: DataTypes.STRING(500),
        field: "company_website",
      },

      totalEmployees: {
        type: DataTypes.INTEGER,
        field: "total_employees",
      },

      employeesUnderImmigrationRules: {
        type: DataTypes.INTEGER,
        field: "employees_under_immigration_rules",
      },

      numberOfCosRequired: {
        type: DataTypes.INTEGER,
        field: "number_of_cos_required",
      },

      // ── Conditional document triggers ─────────────────────────────────────
      // Each flag, when toggled true, activates a set of conditional documents
      // in the intake document checklist.
      conditions: {
        type: DataTypes.JSONB,
        defaultValue: {
          foodBusiness: false,
          alcoholBusiness: false,
          careBusiness: false,
          tupeTransfer: false,
          candidateIdentified: false,
          candidateNotIdentified: false,
        },
      },

      // ── Completion state ───────────────────────────────────────────────────
      isComplete: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
        field: "is_complete",
      },

      submittedAt: {
        type: DataTypes.DATE,
        field: "submitted_at",
      },

      submittedByUserId: {
        type: DataTypes.INTEGER,
        field: "submitted_by_user_id",
      },

      lastUpdatedByUserId: {
        type: DataTypes.INTEGER,
        field: "last_updated_by_user_id",
      },
    },
    {
      tableName: "licence_intake_forms",
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ["licence_application_id"], unique: true, name: "uq_intake_form_application" },
        { fields: ["organisation_id"] },
      ],
    },
  );
}
