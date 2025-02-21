import { EnumValidationStatus, ParsedResultItem } from "dynamsoft-code-parser";
import { DSImageData } from "dynamsoft-core";
import { EnumMRZDocumentType, ResultStatus } from "./types";
import { capitalize } from ".";

// TODO change to EnumMRZDataFields
export enum EnumMRZData {
  InvalidFields = "invalidFields",
  DocumentType = "documentType",
  DocumentNumber = "documentNumber",
  MRZText = "mrzText",
  FirstName = "firstName",
  LastName = "lastName",
  Age = "age",
  Sex = "sex",
  IssuingState = "issuingState",
  Nationality = "nationality",
  DateOfBirth = "dateOfBirth",
  DateOfExpiry = "dateOfExpiry",
}

export interface MRZResult {
  status: ResultStatus;
  originalImageResult?: DSImageData;
  data?: MRZData;

  _imageData?: DSImageData;
}

export interface MRZData {
  [EnumMRZData.InvalidFields]?: EnumMRZData[];
  [EnumMRZData.DocumentType]: string;
  [EnumMRZData.DocumentNumber]: string;
  [EnumMRZData.MRZText]: string;
  [EnumMRZData.FirstName]: string;
  [EnumMRZData.LastName]: string;
  [EnumMRZData.Age]: number;
  [EnumMRZData.Sex]: string;
  [EnumMRZData.IssuingState]: string;
  [EnumMRZData.Nationality]: string;
  [EnumMRZData.DateOfBirth]: MRZDate;
  [EnumMRZData.DateOfExpiry]: MRZDate;
}

export interface MRZDate {
  year: number;
  month: number;
  day: number;
}

export const MRZDataLabel: Partial<Record<EnumMRZData, string>> = {
  // Not showing Invalid Fields
  [EnumMRZData.DocumentType]: "Document Type",
  [EnumMRZData.DocumentNumber]: "Document Number",
  [EnumMRZData.MRZText]: "MRZ Text",
  [EnumMRZData.FirstName]: "First Name",
  [EnumMRZData.LastName]: "Last Name",
  [EnumMRZData.Age]: "Age",
  [EnumMRZData.Sex]: "Sex",
  [EnumMRZData.IssuingState]: "Issuing State",
  [EnumMRZData.Nationality]: "Nationality",
  [EnumMRZData.DateOfBirth]: "Date Of Birth (YY/MM/DD)",
  [EnumMRZData.DateOfExpiry]: "Date Of Expiry (YY/MM/DD)",
};

function calculateAge(birthDate: MRZDate): number {
  const now = new Date();
  const hasBirthdayOccurred =
    now.getMonth() + 1 > birthDate.month || (now.getMonth() + 1 === birthDate.month && now.getDate() >= birthDate.day);

  const currentYear = new Date().getFullYear();
  const birthCentury = birthDate.year > currentYear % 100 ? 1900 : 2000;
  const birthYearFull = birthCentury + birthDate.year;

  return now.getFullYear() - birthYearFull - (hasBirthdayOccurred ? 0 : 1);
}

function parseMRZDate(year: string, month: string, day: string, future: boolean = false): MRZDate {
  return {
    year: parseInt(year, 10),
    month: parseInt(month, 10),
    day: parseInt(day, 10),
  };
}

export function displayMRZDate(date: MRZDate) {
  const twoDigit = (num: number) => (`${num}`?.length === 1 ? `0${num}` : num);
  return `${twoDigit(date?.year)} / ${twoDigit(date?.month)}${date?.day && ` / ${twoDigit(date?.day)}`}`;
}

// Reference: https://www.dynamsoft.com/code-parser/docs/core/code-types/mrtd.html?lang=javascript
function mapDocumentType(codeType: string): EnumMRZDocumentType {
  switch (codeType) {
    case "MRTD_TD1_ID":
      return EnumMRZDocumentType.TD1;

    case "MRTD_TD2_ID":
    case "MRTD_TD2_VISA":
    case "MRTD_TD2_FRENCH_ID":
      return EnumMRZDocumentType.TD2;

    case "MRTD_TD3_PASSPORT":
    case "MRTD_TD3_VISA":
      return EnumMRZDocumentType.Passport;

    default:
      throw new Error(`Unknown document type: ${codeType}`);
  }
}

export function processMRZData(mrzText: string, parsedResult: ParsedResultItem): MRZData | null {
  const invalidFields: EnumMRZData[] = [];

  const isFieldInvalid = (fieldName: string): boolean => {
    const status = parsedResult.getFieldValidationStatus(fieldName);
    const isInvalid = status === EnumValidationStatus.VS_FAILED;

    return isInvalid;
  };

  // Document Type and Name
  const codeType = parsedResult.codeType;
  const documentType = mapDocumentType(codeType);
  // TODO Instead of Passport for TD3, check for visa..

  console.log(documentType, documentType === EnumMRZDocumentType.Passport && codeType === "MRTD_TD3_PASSPORT");
  const documentNumberField =
    documentType === EnumMRZDocumentType.Passport && codeType === "MRTD_TD3_PASSPORT"
      ? "passportNumber"
      : "documentCode";

  // Date
  const dateOfBirth = parseMRZDate(
    parsedResult.getFieldValue("birthYear"),
    parsedResult.getFieldValue("birthMonth"),
    parsedResult.getFieldValue("birthDay")
  );

  const dateOfExpiry = parseMRZDate(
    parsedResult.getFieldValue("expiryYear"),
    parsedResult.getFieldValue("expiryMonth"),
    parsedResult.getFieldValue("expiryDay")
  );

  ["birthYear", "birthMonth", "birthDay"].forEach((dateFields) => {
    if (isFieldInvalid(dateFields)) {
      invalidFields.push(EnumMRZData.DateOfBirth);
    }
  });

  ["expiryYear", "expiryMonth", "expiryDay"].forEach((dateFields) => {
    if (isFieldInvalid(dateFields)) {
      invalidFields.push(EnumMRZData.DateOfExpiry);
    }
  });

  const fields = {
    [EnumMRZData.LastName]: parsedResult.getFieldValue("primaryIdentifier"),
    [EnumMRZData.FirstName]: parsedResult.getFieldValue("secondaryIdentifier"),
    [EnumMRZData.Nationality]: parsedResult.getFieldRawValue("nationality"),
    [EnumMRZData.DocumentNumber]:
      parsedResult.getFieldValue(documentNumberField) || parsedResult.getFieldValue("longDocumentNumber"),
    [EnumMRZData.IssuingState]: parsedResult.getFieldRawValue("issuingState"),
    [EnumMRZData.Sex]: capitalize(parsedResult.getFieldValue("sex")),
  };

  Object.keys(fields).forEach((key) => {
    let invalid = false;
    switch (key) {
      case EnumMRZData.FirstName:
        invalid = isFieldInvalid("secondaryIdentifier");
        break;
      case EnumMRZData.LastName:
        invalid = isFieldInvalid("primaryIdentifier");

        break;
      case EnumMRZData.DocumentNumber:
        invalid = isFieldInvalid(documentNumberField) || isFieldInvalid("longDocumentNumber");

        break;
      default:
        invalid = isFieldInvalid(key);
    }
    if (invalid) {
      invalidFields.push(key as EnumMRZData);
    }
  });

  const age = calculateAge(dateOfBirth);
  if (age < 1) invalidFields.push(EnumMRZData.Age);

  const mrzData: MRZData = {
    [EnumMRZData.InvalidFields]: invalidFields,
    [EnumMRZData.MRZText]: mrzText,
    [EnumMRZData.DocumentType]: capitalize(documentType),
    [EnumMRZData.Age]: age,
    ...fields,
    [EnumMRZData.DateOfBirth]: dateOfBirth,
    [EnumMRZData.DateOfExpiry]: dateOfExpiry,
  };

  return mrzData;
}
