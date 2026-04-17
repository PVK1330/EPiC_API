export default (sequelize, DataTypes) => {
  const Conversation = sequelize.define(
    "Conversation",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      participantOneId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
      },
      participantTwoId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
      },
      caseId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "cases",
          key: "id",
        },
      },
      lastMessage: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      lastMessageAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "conversations",
      timestamps: true,
    }
  );

  return Conversation;
};

