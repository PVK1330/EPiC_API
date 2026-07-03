export default (sequelize, DataTypes) => {
  const Announcement = sequelize.define(
    "Announcement",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      title: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      // e.g. ["caseworker", "sponsor"] — audience checkboxes on the send form.
      targetRoles: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
        field: "target_roles",
      },
      sendEmail: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: "send_email",
      },
      // Recipient count of the LATEST send (refreshed on "update & resend").
      recipients: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      createdBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "created_by",
        references: {
          model: "users",
          key: "id",
        },
        onDelete: "SET NULL",
      },
      // Denormalised so history keeps showing the sender after user deletion.
      createdByName: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "created_by_name",
      },
      organisationId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "organisation_id",
      },
    },
    {
      tableName: "announcements",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return Announcement;
};
