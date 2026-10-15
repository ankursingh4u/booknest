export interface DomNode {
  nodeName: string;
  nodeType?: number;
  nodeValue?: string;
  backendNodeId?: number;
  attributes?: string[];
  children?: DomNode[];
  shadowRoots?: DomNode[];
  contentDocument?: DomNode;
}
export interface CapturedRequest {
  url: string;
  method: string;
  status?: number;
  postData?: string | null;
  responseBody?: string | null;
}
export function findAvailableSlotRows(root: DomNode): DomNode[];
export function hasSlotSelectionChanged(before: DomNode, root: DomNode): boolean;
export function getSuccessfulCartCapture<T extends CapturedRequest>(requests: T[]): T | null;

export function findBookingCartButton(root: DomNode): DomNode | null;
