import { DataTypes } from 'sequelize';

export default (sequelize) => {
  const ApplicationFieldSetting = sequelize.define('ApplicationFieldSetting', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    field_key: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    field_label: {
      type: DataTypes.STRING,
      allowNull: false
    },
    is_visible: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    is_required: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    field_order: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    field_type: {
      type: DataTypes.ENUM('text', 'email', 'number', 'date', 'textarea', 'select', 'checkbox', 'file'),
      defaultValue: 'text'
    },
    options: {
      type: DataTypes.JSON,
      defaultValue: null
    },
    validation_rules: {
      type: DataTypes.JSON,
      defaultValue: null
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    tableName: 'application_field_settings',
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  });

  return ApplicationFieldSetting;
};
