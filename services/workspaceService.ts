import { GeneratedImage } from '../types';

export interface ExportResult {
  presentationId: string;
  presentationUrl: string;
  driveFileId: string;
  driveFileUrl: string;
}

/**
 * Get the natural dimensions of the base64 image
 */
const getImageDimensions = (dataUrl: string): Promise<{ width: number; height: number }> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = dataUrl;
    img.onload = () => {
      resolve({ width: img.naturalWidth || 1024, height: img.naturalHeight || 576 });
    };
    img.onerror = () => {
      resolve({ width: 1024, height: 576 });
    };
  });
};

/**
 * Converts a base64 image string to a Blob
 */
const dataURLToBlob = (dataUrl: string): Blob => {
  const parts = dataUrl.split(',');
  const mimeType = parts[0].match(/:(.*?);/)?.[1] || 'image/png';
  const byteString = atob(parts[1]);
  const array = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) {
    array[i] = byteString.charCodeAt(i);
  }
  return new Blob([array], { type: mimeType });
};

/**
 * Exports an infographic design to a brand new Google Slides Presentation.
 * This uploads the infographic image tool to Google Drive (sharing it by-link so Google Slides can pull it),
 * creates a Slides Presentation, and places the image in standard 16:9 proportionally centered.
 */
export async function exportInfographicToGoogleSlides(
  accessToken: string,
  image: GeneratedImage,
  processedDataUrl: string
): Promise<ExportResult> {
  const topic = image.originalTopic || image.prompt || 'Infographic';
  
  // 1. Get natural dimensions of the processed infographic representation
  const dimensions = await getImageDimensions(processedDataUrl);
  
  // 2. Prepare visual Blob
  const blob = dataURLToBlob(processedDataUrl);
  
  // 3. Upload raw image binary to Google Drive
  const uploadResponse = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=media', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': blob.type
    },
    body: blob
  });
  
  if (!uploadResponse.ok) {
    const errText = await uploadResponse.text();
    throw new Error(`Failed to upload file to Google Drive: ${uploadResponse.statusText}. Details: ${errText}`);
  }
  
  const uploadResult = await uploadResponse.json();
  const fileId = uploadResult.id as string;
  
  // 4. Update the newly created file's metadata (rename, set png type)
  const metadataResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: `InfoGenius - ${topic}.png`,
      mimeType: 'image/png'
    })
  });
  
  if (!metadataResponse.ok) {
    const errText = await metadataResponse.text();
    throw new Error(`Failed to update image metadata on Drive: ${metadataResponse.statusText}. Details: ${errText}`);
  }
  
  // 5. Grant read permission to "anyone" so the background Google Slides system is allowed to download it via URI
  const permissionResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      role: 'reader',
      type: 'anyone'
    })
  });
  
  if (!permissionResponse.ok) {
    const errText = await permissionResponse.text();
    throw new Error(`Failed to set permissions on Drive file: ${permissionResponse.statusText}. Details: ${errText}`);
  }
  
  // 6. Set up the direct link URL that the Slides API can import from
  const imageUrl = `https://docs.google.com/uc?export=download&id=${fileId}`;
  
  // 7. Create a Google Slides Presentation
  const presentationResponse = await fetch('https://slides.googleapis.com/v1/presentations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title: `InfoGenius Infographic Presentation - ${topic}`
    })
  });
  
  if (!presentationResponse.ok) {
    const errText = await presentationResponse.text();
    throw new Error(`Failed to launch Google Slides presentation: ${presentationResponse.statusText}. Details: ${errText}`);
  }
  
  const presentation = await presentationResponse.json();
  const presentationId = presentation.presentationId as string;
  const defaultSlideId = presentation.slides?.[0]?.objectId;
  
  // 8. Calculate proportional translation & matching scales (EMU)
  const slideWidthEmu = 9144000;  // Standard 10 inches wide
  const slideHeightEmu = 5143500; // Standard 5.625 inches high
  
  const marginEmu = 457200; // 0.5 inches margin on borders
  const maxWidthEmu = slideWidthEmu - marginEmu * 2;
  const maxHeightEmu = slideHeightEmu - marginEmu * 2;
  
  const R = dimensions.width / dimensions.height;
  const safeR = maxWidthEmu / maxHeightEmu;
  
  let widthEmu = maxWidthEmu;
  let heightEmu = maxHeightEmu;
  
  if (R > safeR) {
    widthEmu = maxWidthEmu;
    heightEmu = maxWidthEmu / R;
  } else {
    heightEmu = maxHeightEmu;
    widthEmu = maxHeightEmu * R;
  }
  
  const translateX = (slideWidthEmu - widthEmu) / 2;
  const translateY = (slideHeightEmu - heightEmu) / 2;
  
  // 9. Execute batch updating: create our slide, place the image, and gracefully delete the default landing slide
  const customSlideId = 'infographic_slide_page_1';
  
  const requests: any[] = [
    {
      createSlide: {
        objectId: customSlideId,
        insertionIndex: 0,
        slideLayoutReference: {
          predefinedLayout: 'BLANK'
        }
      }
    },
    {
      createImage: {
        elementProperties: {
          pageObjectId: customSlideId,
          size: {
            width: { magnitude: Math.round(widthEmu), unit: 'EMU' },
            height: { magnitude: Math.round(heightEmu), unit: 'EMU' }
          },
          transform: {
            scaleX: 1,
            scaleY: 1,
            translateX: Math.round(translateX),
            translateY: Math.round(translateY),
            unit: 'EMU'
          }
        },
        url: imageUrl
      }
    }
  ];
  
  // Conditionally remove default placeholder slide if created beside ours safely
  if (defaultSlideId) {
    requests.push({
      deleteObject: {
        objectId: defaultSlideId
      }
    });
  }
  
  const editResponse = await fetch(`https://slides.googleapis.com/v1/presentations/${presentationId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ requests })
  });
  
  if (!editResponse.ok) {
    const errText = await editResponse.text();
    throw new Error(`Failed to compile elements into Google Slides: ${editResponse.statusText}. Details: ${errText}`);
  }
  
  return {
    presentationId,
    presentationUrl: `https://docs.google.com/presentation/d/${presentationId}/edit`,
    driveFileId: fileId,
    driveFileUrl: `https://docs.google.com/file/d/${fileId}/view`
  };
}
