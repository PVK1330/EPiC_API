export default (sequelize, DataTypes) => {
  const ChangeRequestHistory = sequelize.define('ChangeRequestHistory', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    change_request_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'change_requests', key: 'id' }
    },
    action: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    performed_by: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'users', key: 'id' }
    },
    role: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    tableName: 'change_request_history',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false // history is immutable
  });

  return ChangeRequestHistory;
};
