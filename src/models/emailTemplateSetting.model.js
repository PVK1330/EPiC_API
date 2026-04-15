export default (sequelize, DataTypes) => {
  const EmailTemplateSetting = sequelize.define(
    "EmailTemplateSetting",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      template_key: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
      },
      subject: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: "",
      },
      body: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: "",
      },
    },
    {
      tableName: "email_templates",
      timestamps: true,
    }
  );

  return EmailTemplateSetting;
};
