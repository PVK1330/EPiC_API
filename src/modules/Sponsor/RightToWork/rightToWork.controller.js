const toISODate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

export const createRtwRecord = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const { workerId, initialCheckDate, referenceNumber, followUpCheckDate, status } = req.body;

    if (!workerId || !initialCheckDate) {
      return res.status(400).json({ status: "error", message: "workerId and initialCheckDate are required" });
    }

    const organisationId = req.user?.organisation_id != null ? Number(req.user.organisation_id) : null;
    const documentPath = req.file ? req.file.path.replace(/\\/g, '/') : null;

    const newRecord = await req.tenantDb.RightToWorkRecord.create({
      workerId,
      sponsorId,
      organisationId,
      initialCheckDate: toISODate(initialCheckDate),
      checkedBy: sponsorId,
      referenceNumber: referenceNumber || null,
      documentPath,
      followUpCheckDate: toISODate(followUpCheckDate),
      status: status || "valid",
    });

    return res.status(201).json({ status: "success", data: newRecord });
  } catch (error) {
    console.error("Error creating right to work record:", error);
    return res.status(500).json({ status: "error", message: "Internal server error" });
  }
};

export const getRtwRecordsByWorker = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const { workerId } = req.params;

    if (!workerId) {
      return res.status(400).json({ status: "error", message: "workerId is required" });
    }

    const records = await req.tenantDb.RightToWorkRecord.findAll({
      where: { workerId, sponsorId },
      include: [
        { model: req.tenantDb.User, as: "worker", attributes: ["id", "first_name", "last_name", "email"] },
        { model: req.tenantDb.User, as: "checker", attributes: ["id", "first_name", "last_name", "email"] },
      ],
      order: [["initialCheckDate", "DESC"]],
    });

    return res.status(200).json({ status: "success", data: records });
  } catch (error) {
    console.error("Error fetching right to work records:", error);
    return res.status(500).json({ status: "error", message: "Internal server error" });
  }
};

export const updateRtwRecord = async (req, res) => {
  try {
    const sponsorId = req.user.userId;
    const { id } = req.params;
    const { initialCheckDate, referenceNumber, followUpCheckDate, status } = req.body;

    const record = await req.tenantDb.RightToWorkRecord.findOne({ where: { id, sponsorId } });
    if (!record) {
      return res.status(404).json({ status: "error", message: "Right to work record not found" });
    }

    record.initialCheckDate = initialCheckDate ? toISODate(initialCheckDate) : record.initialCheckDate;
    record.referenceNumber = referenceNumber !== undefined ? referenceNumber : record.referenceNumber;
    record.followUpCheckDate = followUpCheckDate !== undefined ? toISODate(followUpCheckDate) : record.followUpCheckDate;
    record.status = status || record.status;

    if (req.file) {
      record.documentPath = req.file.path.replace(/\\/g, '/');
    }

    await record.save();

    return res.status(200).json({ status: "success", data: record });
  } catch (error) {
    console.error("Error updating right to work record:", error);
    return res.status(500).json({ status: "error", message: "Internal server error" });
  }
};
