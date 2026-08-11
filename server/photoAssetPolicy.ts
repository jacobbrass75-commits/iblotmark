import type { ProductPhoto } from "@shared/schema";

export type PhotoPublishingStatus = Pick<ProductPhoto, "assetStatus" | "rightsStatus">;

export function isPhotoPublishable(
  photo: PhotoPublishingStatus | null | undefined,
): photo is PhotoPublishingStatus {
  if (!photo || photo.assetStatus !== "approved") return false;
  return photo.rightsStatus === "owned" || photo.rightsStatus === "licensed";
}
