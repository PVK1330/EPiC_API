export default (sequelize, DataTypes) => {
  const CandidateFeedback = sequelize.define(
    "CandidateFeedback",
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
      rating: {
        type: DataTypes.SMALLINT,
        allowNull: false,
      },
      experience_tags: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
      },
      comments: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "candidate_feedbacks",
      timestamps: true,
    }
  );

  return CandidateFeedback;
};
