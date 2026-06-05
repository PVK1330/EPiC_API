export default (sequelize, DataTypes) => {
  const CclTemplate = sequelize.define(
    "CclTemplate",
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      visaTypeId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "visa_type_id",
      },
      name: { type: DataTypes.STRING(255), allowNull: false },
      // Rich-text template body containing {{tags}} (authored in the admin editor).
      bodyHtml: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: "",
        field: "body_html",
      },
      // Optional letterhead / signature blocks (also support {{tags}}).
      headerHtml: { type: DataTypes.TEXT, allowNull: true, field: "header_html" },
      footerHtml: { type: DataTypes.TEXT, allowNull: true, field: "footer_html" },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: "is_active",
      },
      createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    },
    {
      tableName: "ccl_templates",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  );
  return CclTemplate;
};
