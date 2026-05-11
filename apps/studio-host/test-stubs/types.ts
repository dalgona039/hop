export interface DocumentInfo {
  pageCount: number;
  sectionCount?: number;
  fontsUsed?: string[];
}

export interface PageInfo {
  width: number;
  height: number;
  sectionIndex: number;
}

export interface CharProperties {
  [key: string]: unknown;
}

export interface ParaProperties {
  [key: string]: unknown;
}
