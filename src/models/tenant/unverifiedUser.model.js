export default (sequelize, DataTypes) => {
    const UnverifiedUser = sequelize.define(
        "UnverifiedUser",
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },

            first_name: {
                type: DataTypes.STRING(100),
                allowNull: false,
            },
            last_name: {
                type: DataTypes.STRING(100),
                allowNull: false,
            },
            email: {
                type: DataTypes.STRING(255),
                allowNull: false,
                validate: {
                    isEmail: true,
                },
            },

            country_code: {
                type: DataTypes.STRING(10),
                allowNull: false,
            },

            mobile: {
                type: DataTypes.STRING(20),
                allowNull: false,
            },

            password: {
                type: DataTypes.TEXT,
                allowNull: false,
                validate: {
                    len: {
                        args: [8, 100],
                        msg: "Password must be at least 8 characters",
                    },
                },
            },
            otp_code: {
                type: DataTypes.STRING(10),
            },

            otp_expiry: {
                type: DataTypes.DATE,
            },
            temp_password: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            date_of_birth: {
                type: DataTypes.DATEONLY,
                allowNull: true,
            },
            role_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: "roles",
                    key: "id",
                },
                onUpdate: "CASCADE",
                onDelete: "CASCADE",
            },
            organisation_id: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: {
                    model: "organisations",
                    key: "id",
                },
                onUpdate: "CASCADE",
                onDelete: "SET NULL",
            },
        },
        {
            tableName: "unverified_users",
            timestamps: true,

            // Composite Unique (mobile + country_code)
            indexes: [
                {
                    unique: true,
                    fields: ["country_code", "mobile"],
                },
            ],
        }
    );

    return UnverifiedUser;
};
