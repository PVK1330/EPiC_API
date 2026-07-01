/**
 * SponsorLinkedEntity — join table for Section K Multi-Company Handling.
 *
 * Records a parent/subsidiary (or generic "linked") relationship between two
 * SponsorProfile rows. A child profile may appear in at most one row as the
 * child (enforced by a unique index in the migration). A parent may have many
 * children.
 *
 * Table: sponsor_linked_entities
 */
export default (sequelize, DataTypes) => {
    const SponsorLinkedEntity = sequelize.define(
        "SponsorLinkedEntity",
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },
            parentSponsorProfileId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                field: "parent_sponsor_profile_id",
                references: {
                    model: "sponsor_profiles",
                    key: "id",
                },
                onUpdate: "CASCADE",
                onDelete: "CASCADE",
            },
            childSponsorProfileId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                field: "child_sponsor_profile_id",
                references: {
                    model: "sponsor_profiles",
                    key: "id",
                },
                onUpdate: "CASCADE",
                onDelete: "CASCADE",
            },
            relationshipType: {
                type: DataTypes.ENUM("subsidiary", "linked"),
                allowNull: false,
                defaultValue: "subsidiary",
                field: "relationship_type",
            },
            notes: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
        },
        {
            tableName: "sponsor_linked_entities",
            timestamps: true,
            underscored: true,
            indexes: [
                { unique: true, fields: ["child_sponsor_profile_id"] },
                { fields: ["parent_sponsor_profile_id"] },
            ],
        }
    );

    return SponsorLinkedEntity;
};
