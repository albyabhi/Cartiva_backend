import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  title: { type: String, required: true },
  price: { type: Number, required: true },
  originalPrice: { type: Number },
  discount: { type: Number },
  image: { type: String },
  rating: { type: Number },
  url: { type: String, required: true },
  affiliateLink: { type: String, required: true },
  source: { type: String, default: 'Amazon' },
  category: { type: String, default: 'Unknown' },
  addedAt: { type: Date, default: Date.now },
  shareStatus: {
  type: String,
  enum: ['pending', 'shared'],
  default: 'pending',
}
});

export default mongoose.model('Product', productSchema);
