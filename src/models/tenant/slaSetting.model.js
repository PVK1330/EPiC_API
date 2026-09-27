export default (sequelize, DataTypes) => {
  const SlaSetting = sequelize.define(
    "SlaSetting",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      skilled_worker_days: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 45,
      },
      ilr_days: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 30,
      },
      student_visa_days: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 60,
      },
      escalation_stuck_days: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 3,
      },
      missing_docs_escalation_days: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 7,
      },
      // Phase 2 UAT 3.1: how many days before a client's visa expires the
      // dashboard / client list raise a visa expiry alert.
      visa_expiry_alert_days: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 90,
      },
    },
    {
      tableName: "sla_settings",
      timestamps: true,
    }
  );

  return SlaSetting;
};
