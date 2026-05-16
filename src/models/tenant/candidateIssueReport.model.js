export default (sequelize, DataTypes) => {
  const CandidateIssueReport = sequelize.define(
    "CandidateIssueReport",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      case_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "cases", key: "id" },
        onDelete: "SET NULL",
      },
      category: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      severity: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: "medium",
      },
      subject: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      attachment_urls: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
      },
      status: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: "open",
      },
    },
    {
      tableName: "candidate_issue_reports",
      timestamps: true,
    },
  );

  return CandidateIssueReport;
};
