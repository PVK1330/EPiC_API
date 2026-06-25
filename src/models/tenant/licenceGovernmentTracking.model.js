export default (sequelize, DataTypes) => {
  // One row per licence application. Created when the caseworker begins the
  // government portal registration stage. Password field is AES-256 encrypted
  // at the application layer before INSERT — never stored in plain text.
  const LicenceGovernmentTracking = sequelize.define(
    "LicenceGovernmentTracking",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      licenceApplicationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
        field: "licence_application_id",
        references: { model: "licence_applications", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      smsPortalUsername: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "sms_portal_username",
      },
      smsRegistrationRef: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: "sms_registration_ref",
      },
      credentialsGeneratedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "credentials_generated_at",
      },
      credentialsSentAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "credentials_sent_at",
      },
      ukviPortalUserId: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "ukvi_portal_user_id",
      },
      ukviPortalPasswordEncrypted: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "ukvi_portal_password_encrypted",
      },
      ukviCredentialsSubmittedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "ukvi_credentials_submitted_at",
      },
      // Set when the caseworker verifies the sponsor-submitted credentials.
      ukviCredentialsCaseworkerVerifiedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "ukvi_credentials_caseworker_verified_at",
      },
      // Set when the admin verifies the sponsor-submitted credentials.
      ukviCredentialsAdminVerifiedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "ukvi_credentials_admin_verified_at",
      },
      governmentRegistrationRef: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: "government_registration_ref",
      },
      governmentSubmissionRef: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: "government_submission_ref",
      },
      governmentSubmissionDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: "government_submission_date",
      },
      // ── Flow v2 fields ────────────────────────────────────────────────────
      // Set when caseworker sends a prompt email to the sponsor asking them
      // to retrieve their UKVI credentials and submit them in the portal.
      ukviCredentialsRequestedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "ukvi_credentials_requested_at",
      },
      // 5 working-day deadline for sending supporting docs to the Home Office
      // after UKVI submission. Computed by recordGovernmentSubmission().
      homeOfficeDocDeadline: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: "home_office_doc_deadline",
      },
      // Set when the caseworker confirms physical docs dispatched to Home Office.
      homeOfficeDocsSentAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "home_office_docs_sent_at",
      },
      // Optional dispatch/tracking reference for the Home Office submission.
      homeOfficeDocsRef: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "home_office_docs_ref",
      },
    },
    {
      tableName: "licence_government_tracking",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return LicenceGovernmentTracking;
};
