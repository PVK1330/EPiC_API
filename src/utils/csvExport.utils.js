import { format } from "fast-csv";

/**
 * Convert data array to CSV string
 * @param {Array} data - Array of objects to convert to CSV
 * @param {Array} headers - Column headers (optional, inferred from data if not provided)
 * @returns {Promise<string>} CSV string
 */
export const convertToCSV = (data, headers = null) => {
  return new Promise((resolve, reject) => {
    if (!data || data.length === 0) {
      resolve(""); // Return empty string for empty data
      return;
    }

    const csvData = [];
    const stream = format({ headers: headers || true })
      .on("data", (row) => csvData.push(row))
      .on("end", () => resolve(csvData.join("\n")))
      .on("error", (err) => reject(err));

    // Write data to stream
    data.forEach((row) => stream.write(row));
    stream.end();
  });
};

/**
 * Generate CSV file name with timestamp
 * @param {string} reportName - Base name for the report
 * @returns {string} File name with timestamp
 */
export const generateFileName = (reportName) => {
  const timestamp = new Date().toISOString().split("T")[0];
  return `${reportName}_${timestamp}.csv`;
};

/**
 * Send CSV as downloadable file
 * @param {Object} res - Express response object
 * @param {string} csvContent - CSV string content
 * @param {string} fileName - Name of the file to download
 */
export const sendCSVFile = (res, csvContent, fileName) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.send(csvContent);
};

/**
 * Combine multiple data sections into single CSV with section headers
 * @param {Array} sections - Array of {title, data} objects
 * @returns {Promise<string>} Combined CSV string
 */
export const combineSectionsToCSV = async (sections) => {
  try {
    const combinedCSV = [];

    for (const section of sections) {
      if (!section.title || !section.data) {
        continue;
      }

      // Add section header
      combinedCSV.push(`"${section.title}"`);

      // Convert section data to CSV
      if (section.data && section.data.length > 0) {
        const sectionCSV = await convertToCSV(section.data);
        if (sectionCSV) {
          combinedCSV.push(sectionCSV);
        }
      }

      // Add blank line between sections
      combinedCSV.push('""');
    }

    return combinedCSV.join("\n");
  } catch (error) {
    throw new Error(`Failed to combine CSV sections: ${error.message}`);
  }
};
