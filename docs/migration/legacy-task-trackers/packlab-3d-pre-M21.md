# tasks.md — PackLab 3D
# Full Development Plan + Multilingual Support (English, Turkish, Swahili)

---

## 0. Project Definition

PackLab 3D is a desktop application that generates:

- Real-scale 3D mesh from a multi-photo packaging photo set
- Dimensioned 2D technical drawings
- Automatic wall thickness
- Automatic material selection
- Label design engine (5 style options)
- Label placement on 3D model
- Full multilingual UI (English default, Turkish, Swahili)

---

## 1. GitHub Repositories Used

### 1.1 Image Segmentation
- https://github.com/facebookresearch/segment-anything
- https://github.com/IDEA-Research/Grounded-Segment-Anything

### 1.2 3D Reconstruction
- PackLab native multi-photo reconstruction engine
- Generic silhouette/profile/cross-section fitting

### 1.3 Mesh Processing
- https://github.com/isl-org/Open3D
- https://github.com/cnr-isti-vclab/meshlab

### 1.4 CAD / Technical Drawing
- https://github.com/FreeCAD/FreeCAD
- https://github.com/tpaviot/pythonocc-core

### 1.5 Label Rendering
- https://github.com/python-pillow/Pillow
- https://github.com/Kozea/CairoSVG
- https://github.com/Automattic/node-canvas

### 1.6 Desktop Framework
- https://github.com/electron/electron
- https://github.com/tiangolo/fastapi

### 1.7 3D Viewer
- https://github.com/mrdoob/three.js

---

## 2. Multilingual System (English, Turkish, Swahili)

### 2.1 Language Files
- /i18n/en.json
- /i18n/tr.json
- /i18n/sw.json

### 2.2 Language Switching
- UI language selector
- Default language: English
- All UI text, labels, warnings, tooltips, buttons, menus are translated

### 2.3 Backend Language Awareness
- API returns messages in selected language
- Label engine supports multilingual text content

---

## 3. Architecture

### 3.1 Frontend (Electron)
- Measurement input form
- Photo upload
- 3D viewer (Three.js)
- 2D drawing viewer (SVG)
- Label design module
- Label style selector (5 options)
- Language selector (EN/TR/SW)
- Export screen

### 3.2 Backend (Python + FastAPI)
Modules:
- image_processing/
- mesh_generation/
- mesh_scaling/
- wall_thickness/
- material_selection/
- cad_drawings/
- label_engine/
- label_mapping/
- export/
- i18n/

---

## 4. Modules

### 4.1 Image Processing
- SAM segmentation
- Grounded-SAM object isolation
- Background removal

### 4.2 Native Reconstruction
- Photo quality and same-object analysis
- Contour and silhouette extraction
- Generic profile and cross-section fitting
- Measurement-constrained native mesh generation

### 4.3 Mesh Scaling
- Open3D bounding box
- Scale mesh to user measurements (X/Y/Z)
- Real-world dimension accuracy

### 4.4 Wall Thickness
Automatic by packaging type:
- Bottle: 0.8–1.2 mm
- Box: 1.2–2.0 mm
- Sachet: 0.1–0.2 mm
- Jerrycan: 2.0–3.5 mm

### 4.5 Material Selection
Automatic:
- PET
- PP
- HDPE
- LDPE
- PE

### 4.6 Technical Drawing
- FreeCAD TechDraw
- OpenCascade silhouette extraction
- Front/Side/Top views
- Auto dimensioning
- PNG/SVG export

### 4.7 Label Design Engine
Shapes:
- Rectangle
- Oval
- Wrap-around
- Sachet label
- Cap label

Content:
- Brand name
- Product name
- Ingredients
- Warnings
- Symbols (recycle, CE, food-safe, hazard)
- Barcode
- QR code
- Logo

Styles (5 options):
1. Minimal Modern
2. Premium Gold
3. Eco Green
4. Industrial Tech
5. Bold Colorful

### 4.8 Label Mapping
- UV mapping
- 3D placement preview
- Three.js integration

---

## 5. API Endpoints

POST /process-image  
POST /projects/{project_id}/reconstruct  
POST /scale-mesh  
POST /apply-wall-thickness  
POST /generate-2d  
POST /generate-label  
POST /apply-label-to-3d  
POST /export  
POST /set-language  

---

## 6. File Structure

packlab3d/
  frontend/
    electron/
    ui/
    i18n/
  backend/
    api/
    image_processing/
    mesh_generation/
    mesh_scaling/
    wall_thickness/
    material_selection/
    cad_drawings/
    label_engine/
    label_mapping/
    export/
    i18n/
  core/
    utils/
    config/

---

## 7. Development Stages (Claude Tasks)

1. Project setup  
2. Multilingual system setup  
3. Image processing  
4. Mesh generation  
5. Mesh scaling  
6. Wall thickness  
7. Material selection  
8. Technical drawing  
9. Label design engine  
10. Label rendering  
11. Label mapping  
12. UI integration  
13. Testing  
14. Release  

---

## 8. Roadmap

v1.0  
- Full multilingual support  
- 3D + 2D + labels  

v1.5  
- Multi-photo support  
- Material library  

v2.0  
- AI packaging design  
- AI label content generation  
