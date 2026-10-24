"""Cut the subject out of an image for 2.5D parallax: python3 cutout.py in.jpg out_fg.png"""
import sys
from PIL import Image
from rembg import remove

remove(Image.open(sys.argv[1]).convert('RGB')).save(sys.argv[2])
