import { DataTypes } from 'sequelize';

export default (sequelize) => {
  const ApplicationCustomField = sequelize.define('ApplicationCustomField', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    field_id: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    label: {
      type: DataTypes.STRING,
      allowNull: false
    },
    field_type: {
      type: DataTypes.ENUM('text', 'textarea', 'date', 'number'),
      allowNull: false,
      defaultValue: 'text'
    },
    placeholder: {
      type: DataTypes.STRING,
      allowNull: true
    },
    is_required: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
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
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    display_order: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    }
  }, {
    tableName: 'application_custom_fields',
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  });

  return ApplicationCustomField;
};
