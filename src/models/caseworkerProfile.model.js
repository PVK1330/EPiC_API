export default (sequelize, DataTypes) => {
  const CaseworkerProfile = sequelize.define(
    "CaseworkerProfile",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
        references: {
          model: "users",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      employee_id: {
        type: DataTypes.STRING(50),
        allowNull: true,
        unique: true,
      },
      job_title: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      department: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      region: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      timezone: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      date_of_joining: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      emergency_contact_name: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      emergency_contact_phone: {
        type: DataTypes.STRING(30),
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      sla_percentage: {
        type: DataTypes.FLOAT,
        allowNull: true,
        defaultValue: 0,
        validate: {
          min: 0,
          max: 100,
        },
        comment: "SLA compliance percentage (0-100)",
      },
    },
    {
      tableName: "caseworker_profiles",
      timestamps: true,
    }
  );

  return CaseworkerProfile;
};
