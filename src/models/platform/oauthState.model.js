export default (sequelize, DataTypes) => {
  const OAuthState = sequelize.define(
    "OAuthState",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      // Cryptographically-random, single-use CSRF nonce (the OAuth `state`).
      state: {
        type: DataTypes.STRING(128),
        allowNull: false,
        unique: true,
      },
      provider: {
        type: DataTypes.STRING(20),
        allowNull: false,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      organisation_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // The originating session token — stored SERVER-SIDE only, never placed in
      // the OAuth state query parameter. Used to restore the session on callback.
      auth_token: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {
      tableName: "oauth_states",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return OAuthState;
};
