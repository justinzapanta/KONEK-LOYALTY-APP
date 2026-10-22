const fs = require('node:fs')
const path = require('node:path')
const marker = 'private var previewView = PreviewView(context).apply {'
const setting = 'implementationMode = PreviewView.ImplementationMode.COMPATIBLE'

function patchCameraSource(source) {
  if (!source.includes(marker)) throw new Error('expo-camera preview source changed. Review the KONEK camera compatibility fix before building.')
  if (source.includes(setting)) return source
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  return source.replace(marker, marker + newline + '    // KONEK: TextureView renders inside the scanner modal and rounded preview.' + newline + '    ' + setting)
}

function applyCameraPreviewFix() {
  const root = path.dirname(require.resolve('expo-camera/package.json'))
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
  if (version !== '57.0.6') throw new Error('Review the camera preview fix before upgrading expo-camera from 57.0.6.')
  const file = path.join(root, 'android/src/main/java/expo/modules/camera/ExpoCameraView.kt')
  const source = fs.readFileSync(file, 'utf8')
  const fixed = patchPreviewLayout(patchCameraSource(source))
  if (fixed !== source) fs.writeFileSync(file, fixed, 'utf8')
  console.log('KONEK Android camera: compatible TextureView preview configured.')
}

function patchPreviewLayout(source) {
  const marker = '  // KONEK: relayout the native preview after CameraX attaches its child.'
  if (source.includes(marker)) return source
  const start = source.indexOf('  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {')
  const end = source.indexOf('  override fun onViewAdded(child: View?) {', start)
  if (start < 0 || end < 0) throw new Error('expo-camera preview layout source changed. Review the KONEK layout fix before building.')
  const replacement = `  // KONEK: relayout the native preview after CameraX attaches its child.
  private val previewLayoutRunnable = Runnable {
    if (isAttachedToWindow && width > 0 && height > 0) {
      layoutPreview(width, height)
    }
  }

  override fun requestLayout() {
    super.requestLayout()
    // React Native owns the outer layout; CameraX still needs a native child pass.
    // A superclass constructor can request layout before our fields initialize.
    val layoutTask: Runnable? = previewLayoutRunnable
    if (layoutTask != null) {
      removeCallbacks(layoutTask)
      post(layoutTask)
    }
  }

  private fun layoutPreview(width: Int, height: Int) {
    previewView.measure(
      MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY)
    )
    previewView.layout(0, 0, width, height)
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    val width = right - left
    val height = bottom - top
    layoutPreview(width, height)
    if (width != lastWidth || height != lastHeight) {
      glSurfaceTexture?.setDefaultBufferSize(width, height)
      lastWidth = width
      lastHeight = height
    }
  }

`
  return source.slice(0, start) + replacement.replace(/\n/g, source.includes('\r\n') ? '\r\n' : '\n') + source.slice(end)
}

module.exports = { patchCameraSource, patchPreviewLayout, applyCameraPreviewFix }
if (require.main === module) applyCameraPreviewFix()
