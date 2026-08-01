export function mountCameraCapture(container, { onCapture }) {
  container.innerHTML = '';

  const hasCamera =
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function';

  if (!hasCamera) {
    return { destroy() {} }; // no webcam API available — silently omit the feature
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'camera-capture';

  const takeBtn = document.createElement('button');
  takeBtn.type = 'button';
  const icon = document.createElement('img');
  icon.src = 'icons/camera.svg';
  icon.alt = '';
  const label = document.createElement('span');
  label.textContent = 'Take Photo';
  takeBtn.append(icon, label);

  const video = document.createElement('video');
  video.autoplay = true;
  video.style.display = 'none';

  const shootBtn = document.createElement('button');
  shootBtn.type = 'button';
  shootBtn.textContent = 'Capture';
  shootBtn.style.display = 'none';

  let stream = null;

  async function startCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
    } catch (err) {
      takeBtn.textContent = 'Camera unavailable';
      takeBtn.disabled = true;
      return;
    }
    video.srcObject = stream;
    video.style.display = 'block';
    shootBtn.style.display = 'inline-block';
    takeBtn.style.display = 'none';
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    video.style.display = 'none';
    shootBtn.style.display = 'none';
    takeBtn.style.display = 'inline-flex';
  }

  function capture() {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `capture-${Date.now()}.png`, { type: 'image/png' });
      stopCamera();
      if (onCapture) onCapture(file);
    }, 'image/png');
  }

  takeBtn.addEventListener('click', startCamera);
  shootBtn.addEventListener('click', capture);

  wrapper.append(takeBtn, video, shootBtn);
  container.appendChild(wrapper);

  return {
    destroy() {
      stopCamera();
    },
  };
}
